<?php
/**
 * The template for displaying all team single posts
 *
 * @link https://developer.wordpress.org/themes/basics/template-hierarchy/#single-post
 *
 * @package Restly
 */

get_header();
if(get_post_meta( get_the_ID(), 'restly_metabox', true)) {
    $restly_commonMeta = get_post_meta( get_the_ID(), 'restly_metabox', true );
} else {
    $restly_commonMeta = array();
}
$restly_team_title = restly_options('restly_team_title');
$restly_team_banner_enable = restly_options('restly_team_banner_enable');
if(array_key_exists('restly_layout_meta', $restly_commonMeta) && !empty($restly_commonMeta['restly_layout_meta'])){
    $restly_team_Layout = $restly_commonMeta['restly_layout_meta'];
}else{
    $restly_team_Layout = 'full-width';
}
if(is_array($restly_commonMeta) && array_key_exists('restly_sidebar_meta', $restly_commonMeta)){
    $restly_selectedSidebar = $restly_commonMeta['restly_sidebar_meta'];
}else{
    $restly_selectedSidebar = 'sidebar';
}

if($restly_team_Layout == 'left-sidebar' && is_active_sidebar($restly_selectedSidebar) || $restly_team_Layout == 'right-sidebar' && is_active_sidebar($restly_selectedSidebar)){
    $restly_teamColumnClass = 'col-12 col-sm-12 col-md-12 col-lg-7 col-xl-8';
}else{
    $restly_teamColumnClass = 'col-12 col-sm-12 col-md-12 col-lg-12 col-xl-12';
}

if($restly_team_banner_enable == false ){
    $restly_team_post_Banner = false;
}elseif(array_key_exists('restly_meta_enable_banner', $restly_commonMeta)){
    $restly_team_post_Banner = $restly_commonMeta['restly_meta_enable_banner'];
}else{
    $restly_team_post_Banner = true;
}
if($restly_team_Layout == 'full-width'){
	$restly_sidebar_bg = 'sidebar-no-bg-main';
}else{
	$restly_sidebar_bg = 'sidebar-bg-main';
}
?>
	<?php if($restly_team_post_Banner == true ) : ?>
	<div class="breadcroumb-area">
		<div class="container">
			<div class="breadcroumn-contnt">
				<h2><?php if(!empty($restly_team_title)){
					echo esc_html($restly_team_title);
				}else{
					echo esc_html('Team Details','restly');
				}?></h2>
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
		<div class="container">
			<div class="page-layout <?php echo esc_attr($restly_team_Layout); ?>">
				<div class="row">
					<?php
					if($restly_team_Layout == 'left-sidebar' && is_active_sidebar($restly_selectedSidebar)){
						get_sidebar();
					}
					?>
					<div class="<?php echo esc_attr($restly_teamColumnClass); ?>">
						<div class="all-posts-wrapper">
						<?php
							while ( have_posts() ) :
								the_post();

								the_content();
							endwhile; // End of the loop.
							?>
						</div>
					</div>
					<?php
                    if($restly_team_Layout == 'right-sidebar' && is_active_sidebar($restly_selectedSidebar)){
                        get_sidebar();
                    }?>
				</div>
			</div>
		</div>
	</main><!-- #main -->
<?php
get_footer();