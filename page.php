<?php
/**
 * The template for displaying all pages
 *
 * This is the template that displays all pages by default.
 * Please note that this is the WordPress construct of pages
 * and that other 'pages' on your WordPress site may use a
 * different template.
 *
 * @link https://developer.wordpress.org/themes/basics/template-hierarchy/
 *
 * @package Restly
 */

get_header();
if(get_post_meta( get_the_ID(), 'restly_metabox', true)) {
    $restly_commonMeta = get_post_meta( get_the_ID(), 'restly_metabox', true );
} else {
    $restly_commonMeta = array();
}
if(array_key_exists('restly_meta_page_navbar', $restly_commonMeta)){
	$restly_meta_page_navbar = $restly_commonMeta['restly_meta_page_navbar'];
}else{
	$restly_meta_page_navbar = '';
}
if(array_key_exists('restly_layout_meta', $restly_commonMeta)){
    $restly_pageLayout = $restly_commonMeta['restly_layout_meta'];
}else{
    $restly_pageLayout = 'full-width';
}

if(array_key_exists('restly_sidebar_meta', $restly_commonMeta)){
    $restly_selectedSidebar = $restly_commonMeta['restly_sidebar_meta'];
}else{
    $restly_selectedSidebar = 'sidebar';
}

if($restly_pageLayout == 'left-sidebar' && is_active_sidebar($restly_selectedSidebar) || $restly_pageLayout == 'right-sidebar' && is_active_sidebar($restly_selectedSidebar)){
    $restly_pageColumnClass = 'col-12 col-sm-12 col-md-12 col-lg-7 col-xl-8';
}else{
    $restly_pageColumnClass = 'col-12 col-sm-12 col-md-12 col-lg-12 col-xl-12';
}
if(array_key_exists('restly_meta_enable_banner', $restly_commonMeta)){
    $restly_postBanner = $restly_commonMeta['restly_meta_enable_banner'];
}else{
    $restly_postBanner = true;
}
$restly_enable_page_cmt = restly_options('restly_enable_page_cmt', true );

if($restly_pageLayout == 'full-width'){
	$restly_sidebar_bg = 'sidebar-no-bg-main';
}else{
	$restly_sidebar_bg = 'sidebar-bg-main';
}
?>
<?php if($restly_postBanner == true ) : ?>
	<div class="breadcroumb-area">
		<div class="container">
			<div class="breadcroumn-contnt">
				<h2> <?php the_title(); ?> </h2>
				<div class="bre-sub">
				<?php if(function_exists('bcn_display')){
					bcn_display();
				}?>
				</div>
			</div>
		</div>
	</div>
<?php endif; ?>
	<main id="primary" class="site-main content-area <?php echo esc_attr($restly_sidebar_bg); ?>">
		<div class="container <?php echo esc_attr($restly_pageLayout); ?>">
			<div class="page-layout">
				<div class="row">
					<?php
					if($restly_pageLayout == 'left-sidebar' && is_active_sidebar($restly_selectedSidebar)){
						get_sidebar();
					}
					?>
					<div class="<?php echo esc_attr($restly_pageColumnClass); ?>">
						<div class="all-posts-wrapper">
						<?php
							while ( have_posts() ) :
								the_post();
								get_template_part( 'template-parts/content', 'page' );
							endwhile; // End of the loop.
							if( $restly_enable_page_cmt == true) :
								if ( comments_open() || get_comments_number() ) :
									comments_template();
								endif;
							endif;
						?>
						</div>
					</div>
					<?php
					if($restly_pageLayout == 'right-sidebar' && is_active_sidebar($restly_selectedSidebar)){
						get_sidebar();
					}?>
				</div>
			
			</div>
		</div>
	</main><!-- #main -->
<?php get_footer();
