<?php
/**
 * The template for displaying search results pages
 *
 * @link https://developer.wordpress.org/themes/basics/template-hierarchy/#search-result
 *
 * @package Restly
 */

get_header();
$restly_searchLayout = restly_options('restly_search_layout', 'right-sidebar');
$restly_search_banner = restly_options('restly_search_banner', true);
$restly_search_pagination = restly_options('restly_search_pagination', true);
if($restly_searchLayout == 'grid'){
	$restly_sidebar_bg = 'sidebar-no-bg-main';
}else{
	$restly_sidebar_bg = 'sidebar-bg-main';
}
?>
	<?php if($restly_search_banner == true ) : ?>
	<div class="breadcroumb-area">
		<div class="container">
			<div class="breadcroumn-contnt">
				<h2>
					<?php 
					/* translators: %s: search query. */
					printf( esc_html__( 'Search Results for: %s', 'restly' ), '<span>' . get_search_query() . '</span>' );
					?>
				</h2>
				<div class="bre-sub">
				<?php if(function_exists('bcn_display')){
					bcn_display();
				}?>
				</div>
			</div>
		</div>
	</div>
	<?php endif; ?>
	<main id="primary" class="site-main content-area sidebar-bg-main <?php echo esc_attr($restly_sidebar_bg); ?>">
		<div class="container page-layout <?php echo esc_attr($restly_searchLayout); ?>">
			<?php
				if ( $restly_searchLayout == 'grid' ) {
					get_template_part( 'template-parts/blog/post-grid' );
				} else {
					get_template_part( 'template-parts/blog/post-sidebar' );
				}?>
				
		</div>
	</main><!-- #main -->
<?php get_footer();
