<?php 

$footer_col = '3_3_3_3';
if( !empty(restly_options('footer_column_layout')) ){
	$footer_col = esc_attr(restly_options('footer_column_layout'));
}
$footer_start	= '';
$footer_end		= '';
if ( is_active_sidebar( 'footer-1' ) || is_active_sidebar( 'footer-2' ) || is_active_sidebar( 'footer-3' ) || is_active_sidebar( 'footer-4' )) 
{
	$footer_start='<div class="footer-widget-section">';
	$footer_end='</div>';
}	

echo wp_kses($footer_start,'restly_allowed_html');
if ( is_active_sidebar( 'footer-1' ) || is_active_sidebar( 'footer-2' ) || is_active_sidebar( 'footer-3' ) || is_active_sidebar( 'footer-4' ) ) 
{
    ?>
	<div class="restly-footer-widgets">
	    <div class="container">
	        <?php 
			if($footer_col == '3_3_3_3'){
	        ?>
	        <div class="row restly-ftw-box">
	        	<?php if ( is_active_sidebar( 'footer-1' ) ) : ?>
					<div class="col-xs-12 col-sm-12 col-md-6 col-lg-6 col-xl-3">
						<?php dynamic_sidebar( 'footer-1' ); ?>
					</div><!-- .widget-area -->
				<?php endif; ?>
	        	<?php if ( is_active_sidebar( 'footer-2' ) ) : ?>
					<div class="col-xs-12 col-sm-12 col-md-6 col-lg-6 col-xl-3">
						<?php dynamic_sidebar( 'footer-2' ); ?>
					</div><!-- .widget-area -->
				<?php endif; ?>	
	        	<?php if ( is_active_sidebar( 'footer-3' ) ) : ?>
					<div class="col-xs-12 col-sm-12 col-md-6 col-lg-6 col-xl-3">
						<?php dynamic_sidebar( 'footer-3' ); ?>
					</div><!-- .widget-area -->
				<?php endif; ?>
                <?php if ( is_active_sidebar( 'footer-3' ) ) : ?>
					<div class="col-xs-12 col-sm-12 col-md-6 col-lg-6 col-xl-3">
						<?php dynamic_sidebar( 'footer-4' ); ?>
					</div><!-- .widget-area -->
				<?php endif; ?>							
	        </div>
	    	<?php }else{ ?>
	    		<div class="row restly-ftw-box">
	    			<?php
					$footer_col = explode('_', $footer_col);
					
					if( is_array($footer_col) && count($footer_col)>0 ){
						$i = 1;
						foreach($footer_col as $col){
						// ROW width class
						$row_class = 'col-xs-12 col-sm-12 col-md-6 col-lg-6 col-xl-'.$col;
						if ( is_active_sidebar( 'footer-'.$i.'' ) ) : ?>
							<div class="widget-area <?php echo esc_attr($row_class); ?> footer">
								<?php dynamic_sidebar( 'footer-'.$i.'' ); ?>
							</div><!-- .widget-area -->
						<?php endif;
						$i++;
						} // Foreach
					} // If	    			
	    			?>
	    		</div>	
	    	<?php } ?>
	    </div>    
	</div>
	<?php
}
echo wp_kses($footer_end,'restly_allowed_html');
?>